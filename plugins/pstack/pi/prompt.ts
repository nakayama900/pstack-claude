import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readSheet, type Settings } from "./config.ts";

const MANDATE_SECTION = "pstack-session-start";
const SHEET_SECTION = "pstack-models";
const PARALLEL_SECTION = "pstack-parallel-calls";
const TOOLS_SECTION = "pstack-pi-tools";

// pstack skills name Claude Code tools and models. A session with the hook off,
// a child agent, or a skill invoked directly may never see the pointer in
// poteto-mode/SKILL.md, so every session gets it here.
function piToolsNote(pluginRoot: string): string {
  const file = join(pluginRoot, "skills", "poteto-mode", "references", "pi-tools.md");
  return `pstack skills are written for Claude Code. When one names a Claude Code tool (Agent, Skill, AskUserQuestion, Bash), a bundled skill, or a Claude model, read ${file} for the Pi equivalent before following it.`;
}
// Claude Code's system prompt, word for word but for its function_calls block.
// pstack skills that say "one message, N Agent calls" rely on it.
const PARALLEL_CALLS =
  "If you intend to call multiple tools and there are no dependencies between the calls, make all of the independent calls in the same response, otherwise you MUST wait for previous calls to finish first to determine the dependent values.";

// Claude Code runs the session hook and loads the sheet through a CLAUDE.md
// include; Pi has neither, so both ride as system prompt sections, set again
// on every agent start so compaction cannot drop them.
// A child gets the sheet, as a Claude Code subagent sees CLAUDE.md, but not
// the mandate: SessionStart does not run for subagents.
// pi (upstream) carries systemPromptOptions.sections; omp's event does not.
function piSections(event: unknown): Record<string, string> | undefined {
  if (!(event && typeof event === "object" && "systemPromptOptions" in event)) return;
  const opts = event.systemPromptOptions;
  if (!(opts && typeof opts === "object" && "sections" in opts)) return;
  const sections = opts.sections;
  if (!(sections && typeof sections === "object" && !Array.isArray(sections))) return;
  return sections as Record<string, string>;
}

// omp and pi disagree on BeforeAgentStartEvent shape, so type the handler locally and cast once at the boundary.
type OnBeforeAgentStart = (
  handler: (event: { prompt: string; systemPrompt?: string[] }) => { systemPrompt?: string[] } | void,
) => void;

export function registerPromptSections(pi: ExtensionAPI, settings: Settings): void {
  const mandateFile = join(settings.pluginRoot, "hooks", "session-start-context.md");
  // Cast needed only because omp/pi event shapes differ; the runtime handler below fits both.
  const onBeforeAgentStart = ((handler: Parameters<OnBeforeAgentStart>[0]) =>
    pi.on("before_agent_start", handler as never)) as OnBeforeAgentStart;
  onBeforeAgentStart((event) => {
    const sheet = readSheet(settings.agentDir);
    const parts: [string, string][] = [[TOOLS_SECTION, piToolsNote(settings.pluginRoot)]];
    if (settings.depth === 0 && !sheet?.hookOff) parts.push([MANDATE_SECTION, readFileSync(mandateFile, "utf8")]);
    if (sheet) parts.push([SHEET_SECTION, sheet.text]);

    // pi (upstream): mutate the structured sections record.
    const sections = piSections(event);
    if (sections) {
      sections[PARALLEL_SECTION] = PARALLEL_CALLS;
      for (const [key, text] of parts) sections[key] = text;
      return;
    }
    // omp: event.systemPrompt is a string[]; returning systemPrompt replaces it (chained across extensions).
    const base = event.systemPrompt ?? [];
    const seen = new Set(base);
    return { systemPrompt: [...base, ...[PARALLEL_CALLS, ...parts.map(([, text]) => text)].filter((p) => !seen.has(p))] };
  });
}
