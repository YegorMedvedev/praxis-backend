import type { Language } from '../domain/language';
import type {
  EndedBy,
  SessionStatus,
  SessionWithStats,
} from '../domain/session';

/**
 * What the API shows of a session. Deliberately has no `agentId` and no
 * `openaiSessionId`: server-side attributes never leave the application layer.
 */
export interface SessionView {
  id: string;
  caseId: string;
  language: Language;
  status: SessionStatus;
  createdAt: Date;
  endedAt: Date | null;
  stats: {
    therapistMessageCount: number;
    patientMessageCount: number;
    durationSeconds: number | null;
    endedBy: EndedBy | null;
  };
}

export function toSessionView({
  session,
  therapistMessageCount,
  patientMessageCount,
}: SessionWithStats): SessionView {
  return {
    id: session.id,
    caseId: session.caseId,
    language: session.language,
    status: session.status,
    createdAt: session.createdAt,
    endedAt: session.endedAt,
    stats: {
      therapistMessageCount,
      patientMessageCount,
      durationSeconds: session.durationSeconds(),
      endedBy: session.endedBy(),
    },
  };
}
