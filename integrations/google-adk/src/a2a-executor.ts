import { Role, TaskState } from "@a2a-js/sdk";
import type { Artifact, Message, Part } from "@a2a-js/sdk";
import { AgentEvent } from "@a2a-js/sdk/server";
import type {
  AgentExecutor,
  ExecutionEventBus,
  RequestContext,
} from "@a2a-js/sdk/server";
import { Runner, StreamingMode } from "@google/adk";
import type { Event } from "@google/adk";

/**
 * A2A 1.0 AgentExecutor driving the Google ADK Runner directly.
 *
 * Why not ADK's bundled A2AAgentExecutor? Verified against the published
 * packages: @google/adk@1.6.0 depends on @a2a-js/sdk ^0.3.10, and its
 * A2AAgentExecutor implements the 0.3 AgentExecutor interface — type- and
 * wire-incompatible with the A2A 1.0 DefaultRequestHandler from
 * @a2a-js/sdk@1.0.1. This integration therefore implements the 1.0
 * AgentExecutor interface (Task/statusUpdate/artifactUpdate events) against
 * the ADK Runner, keeping the exposed surface fully A2A 1.0.
 */
export class TrueMandateA2AExecutor implements AgentExecutor {
  private readonly runner: Runner;

  constructor(runner: Runner) {
    this.runner = runner;
  }

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId } = requestContext;
    const userText = extractText(requestContext.userMessage);

    // The server requires the first event to be a `task`.
    eventBus.publish(
      AgentEvent.task({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: undefined,
      }),
    );
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: undefined,
      }),
    );

    try {
      let finalText = "";
      for await (const event of this.runner.runEphemeral({
        userId: contextId,
        newMessage: { role: "user", parts: [{ text: userText }] },
        runConfig: { streamingMode: StreamingMode.NONE },
      })) {
        const text = collectAdkText(event);
        if (text) finalText = text;
      }
      const text = finalText || "(no response)";

      const artifact: Artifact = {
        artifactId: `artifact-${taskId}`,
        name: "agent-response",
        description: "",
        parts: [textPart(text)],
        metadata: undefined,
        extensions: [],
      };
      eventBus.publish(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          artifact,
          append: false,
          lastChunk: true,
          metadata: undefined,
        }),
      );
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            message: agentMessage(text, contextId, taskId),
            timestamp: undefined,
          },
          metadata: undefined,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_FAILED,
            message: agentMessage(message, contextId, taskId),
            timestamp: undefined,
          },
          metadata: undefined,
        }),
      );
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId: "",
        status: { state: TaskState.TASK_STATE_CANCELED, message: undefined, timestamp: undefined },
        metadata: undefined,
      }),
    );
  }
}

function textPart(text: string): Part {
  return {
    content: { $case: "text", value: text },
    metadata: undefined,
    filename: "",
    mediaType: "text/plain",
  };
}

function agentMessage(text: string, contextId: string, taskId: string): Message {
  return {
    messageId: `msg-${taskId}-final`,
    contextId,
    taskId,
    role: Role.ROLE_AGENT,
    parts: [textPart(text)],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}

function extractText(message: Message): string {
  return message.parts
    .map((p) => (p.content?.$case === "text" ? p.content.value : ""))
    .join("");
}

function collectAdkText(event: Event): string {
  const parts = event.content?.parts ?? [];
  let out = "";
  for (const part of parts) {
    if (typeof part === "object" && part !== null && "text" in part && typeof part.text === "string") {
      out += part.text;
    }
  }
  return out;
}
