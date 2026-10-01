import type { Hooks } from "@opencode-ai/plugin";

// Calm, minimal, smooth — intuitive output
// Strip the noise, let the content breathe

function isBlank(line: string) {
  return /^\s*$/.test(line);
}

function cleanLine(line: string) {
  return line.trim().replace(/\s+/g, " ");
}

export const server = async (): Promise<Hooks> => {
  return {
    "tool.execute.after": async (input, output) => {
      if (!output?.output) return output;

      let text = output.output as string;
      const tool = input?.tool;

      // Remove tool banners like "Reading: path/to/file" and blank leaders
      text = text.replace(/^(?:Reading|Reading file|File):[^\n]+\n+/gi, "");
      text = text.replace(/^(?:Output|Result|Response):\s*\n+/gi, "");

      // Collapse blank lines, keep at most 2 consecutive
      text = text.replace(/\n{3,}/g, "\n\n");

      // Trim each line
      text = text.split("\n").map(l => isBlank(l) ? "" : cleanLine(l)).join("\n");

      // Gentle read safety cap: only truncate extremely large reads (>16k chars)
      // Small and medium files (<16k) remain intact so code edits and tests do not break
      if ((tool === "read" || tool === "tool.read") && text.length > 16000) {
        text = text.slice(0, 16000) + "\n\n... [truncated at 16,000 chars — use offset and limit parameters for targeted slices]";
      }

      // For bash: truncate massive stdout dumps (>3000 chars) keeping head + tail
      if (tool === "bash" && text.length > 3000) {
        const lines = text.split("\n");
        if (lines.length > 45) {
          const head = lines.slice(0, 30).join("\n");
          const tail = lines.slice(-15).join("\n");
          text = `${head}\n\n... [${lines.length - 45} lines / ${text.length - 3000} chars truncated — use grep or output redirect] ...\n\n${tail}`;
        }
        text = text.replace(/\n+$/, "");
      }

      return { ...output, output: text };
    },
  };
};
