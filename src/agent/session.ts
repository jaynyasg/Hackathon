/** In-memory per-conversation state. (Scale-path: swap for Redis/db.) */
import { GREETING, SYSTEM_PROMPT } from "./prompt";
import type { LlmMessage } from "./llm";
import type {
  Form1040Result,
  TaxpayerProfile,
  TurnObservation,
  W2Data,
} from "../shared/contract";

export type SessionState = {
  id: string;
  messages: LlmMessage[]; // full history (system + user/assistant/tool)
  profile: TaxpayerProfile;
  w2: W2Data | null;
  w2RawText: string | null;
  w2Bytes: Uint8Array | null;
  w2Filename: string | null;
  result: Form1040Result | null;
  pdfBytes: Uint8Array | null;
  questionsAsked: number;
  budgetNudged: boolean;
  turns: TurnObservation[];
  createdAt: number;
};

const sessions = new Map<string, SessionState>();

export function getSession(id: string): SessionState {
  let s = sessions.get(id);
  if (!s) {
    s = {
      id,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "assistant", content: GREETING },
      ],
      profile: { dependents: [] },
      w2: null,
      w2RawText: null,
      w2Bytes: null,
      w2Filename: null,
      result: null,
      pdfBytes: null,
      questionsAsked: 0,
      budgetNudged: false,
      turns: [],
      createdAt: Date.now(),
    };
    sessions.set(id, s);
  }
  return s;
}

export function resetSession(id: string): void {
  sessions.delete(id);
}
