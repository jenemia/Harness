#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  getProject,
  getProjectOverview,
  listAgentTemplates,
  listProjectTemplates,
  listProjectsWithSummaries,
  listWorkflowTemplates,
  registerProject,
  seedDefaultAgents,
  seedProjectFromTemplate
} from "./db.js";
import { createPlan, type PlanningMode } from "./planner.js";
import { startReadyTasks, startTask } from "./runtime.js";

type CommandHandler = (args: string[]) => Promise<unknown> | unknown;

const commands: Record<string, CommandHandler> = {
  "projects:list": listProjectsCommand,
  "projects:register": registerProjectCommand,
  "projects:overview": overviewCommand,
  "templates:agents": listAgentTemplatesCommand,
  "templates:workflows": listWorkflowTemplatesCommand,
  "templates:projects": listProjectTemplatesCommand,
  "plans:create": createPlanCommand,
  "tasks:start": startTaskCommand,
  "tasks:schedule": scheduleCommand
};

async function main() {
  const [commandName, ...args] = process.argv.slice(2);
  if (!commandName || commandName === "help" || commandName === "--help" || commandName === "-h") {
    printHelp();
    return;
  }

  const command = commands[commandName];
  if (!command) {
    throw new Error(`Unknown command: ${commandName}`);
  }

  const result = await command(args);
  if (result !== undefined) {
    console.log(JSON.stringify(result, null, 2));
  }
}

function listProjectsCommand() {
  return { projects: listProjectsWithSummaries() };
}

function registerProjectCommand(args: string[]) {
  const options = parseOptions(args);
  const projectPath = getRequiredOption(options, "path");
  const name = options.name || path.basename(projectPath);
  const seedDefaults = options.seedDefaults !== "false";
  const project = registerProject(path.resolve(projectPath), name);
  if (options.projectTemplate) {
    seedProjectFromTemplate(project.path, options.projectTemplate);
  } else if (seedDefaults) {
    seedDefaultAgents(project.path);
  }
  return { project, overview: getProjectOverview(project) };
}

function overviewCommand(args: string[]) {
  const project = getRequiredProject(args);
  return getProjectOverview(project);
}

async function scheduleCommand(args: string[]) {
  const project = getRequiredProject(args);
  const schedule = await startReadyTasks(project);
  return { schedule, overview: getProjectOverview(project) };
}

function listAgentTemplatesCommand() {
  return { templates: listAgentTemplates() };
}

function listWorkflowTemplatesCommand() {
  return { templates: listWorkflowTemplates() };
}

function listProjectTemplatesCommand() {
  return { templates: listProjectTemplates() };
}

async function createPlanCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const goal = readGoal(options);
  const mode = normalizeMode(options.mode);
  const plan = createPlan(project, {
    goal,
    mode,
    workflowTemplateId: options.workflowTemplate
  });
  const shouldAutoStart = options.autoStart === "true";
  const schedule = shouldAutoStart ? await startReadyTasks(project) : null;
  return { plan, schedule, overview: getProjectOverview(project) };
}

async function startTaskCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const result = await startTask(project, taskId);
  return { result, overview: getProjectOverview(project) };
}

function getRequiredProject(args: string[]) {
  const options = parseOptions(args);
  const projectId = getRequiredOption(options, "project");
  const project = getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  return project;
}

function parseOptions(args: string[]) {
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = "true";
      continue;
    }

    options[key] = next;
    index += 1;
  }
  return options;
}

function getRequiredOption(options: Record<string, string>, key: string) {
  const value = options[key]?.trim();
  if (!value) {
    throw new Error(`Missing required option: --${key}`);
  }
  return value;
}

function readGoal(options: Record<string, string>) {
  if (options.goalFile) {
    return readFileSync(path.resolve(options.goalFile), "utf8");
  }

  return getRequiredOption(options, "goal");
}

function normalizeMode(value: string | undefined): PlanningMode {
  if (!value) {
    return "sequential";
  }
  if (value === "sequential" || value === "parallel") {
    return value;
  }
  throw new Error("--mode must be sequential or parallel.");
}

function printHelp() {
  console.log(`Harness CLI

Usage:
  pnpm --filter @harness/server cli projects:list
  pnpm --filter @harness/server cli projects:register --path <folder> [--name <name>] [--seedDefaults false] [--projectTemplate <id>]
  pnpm --filter @harness/server cli projects:overview --project <projectId>
  pnpm --filter @harness/server cli templates:agents
  pnpm --filter @harness/server cli templates:workflows
  pnpm --filter @harness/server cli templates:projects
  pnpm --filter @harness/server cli plans:create --project <projectId> (--goal <text> | --goalFile <file>) [--mode sequential|parallel] [--workflowTemplate <id>] [--autoStart true]
  pnpm --filter @harness/server cli tasks:schedule --project <projectId>
  pnpm --filter @harness/server cli tasks:start --project <projectId> --task <taskId>

All commands print JSON and use HARNESS_HOME when set.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
