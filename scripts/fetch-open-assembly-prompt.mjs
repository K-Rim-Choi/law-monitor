import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: process.stdin.isTTY,
});
const writeToOutput = rl._writeToOutput.bind(rl);
rl.muted = false;
rl._writeToOutput = (text) => {
  if (!rl.muted) {
    writeToOutput(text);
  }
};

const key = await promptHidden(rl, "OPEN_ASSEMBLY_API_KEY");
rl.close();

if (!key) {
  console.error("API key is required.");
  process.exit(1);
}

const child = spawn("node", ["scripts/fetch-open-assembly.mjs"], {
  env: {
    ...process.env,
    OPEN_ASSEMBLY_API_KEY: key,
    BILL_ERACO: process.env.BILL_ERACO || "22",
  },
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

async function promptHidden(rl, label) {
  return new Promise((resolve) => {
    process.stdout.write(`${label}: `);
    rl.muted = true;
    rl.question("", (answer) => {
      rl.muted = false;
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}
