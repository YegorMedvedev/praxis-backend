import { SessionEndedError } from '../../../shared/domain-error';
import type { Language } from './language';

export const SESSION_STATUSES = [
  'IN_PROGRESS',
  'ENDED_BY_THERAPIST',
  // Reserved by the contract. Nothing in this milestone produces it: the
  // patient agent has no tool to end a session.
  'ENDED_BY_PATIENT',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type EndedBy = 'THERAPIST' | 'PATIENT';

export interface SessionProps {
  id: string;
  /** Firebase uid of the learner. Plain id: no cross-schema reference. */
  userId: string;
  caseId: string;
  language: Language;
  status: SessionStatus;
  createdAt: Date;
  endedAt: Date | null;
  /** Resolved at creation, never changed. Server-side only. */
  agentId: string;
  /** Remote OpenAI session, once one exists. Server-side only. */
  openaiSessionId: string | null;
  /** False when the remote session may differ from our transcript. */
  remoteInSync: boolean;
}

export interface StartSessionCommand {
  id: string;
  userId: string;
  caseId: string;
  language: Language;
  agentId: string;
  now: Date;
}

/**
 * One practice conversation between one learner and one case's patient.
 * `IN_PROGRESS` moves to an ended state once; ended states are terminal.
 */
export class Session {
  private constructor(private props: SessionProps) {}

  static start(command: StartSessionCommand): Session {
    return new Session({
      id: command.id,
      userId: command.userId,
      caseId: command.caseId,
      language: command.language,
      status: 'IN_PROGRESS',
      createdAt: command.now,
      endedAt: null,
      agentId: command.agentId,
      openaiSessionId: null,
      remoteInSync: true,
    });
  }

  static restore(props: SessionProps): Session {
    return new Session({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get caseId(): string {
    return this.props.caseId;
  }
  get language(): Language {
    return this.props.language;
  }
  get status(): SessionStatus {
    return this.props.status;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get endedAt(): Date | null {
    return this.props.endedAt;
  }
  get agentId(): string {
    return this.props.agentId;
  }
  get openaiSessionId(): string | null {
    return this.props.openaiSessionId;
  }
  get remoteInSync(): boolean {
    return this.props.remoteInSync;
  }

  isInProgress(): boolean {
    return this.props.status === 'IN_PROGRESS';
  }

  endedBy(): EndedBy | null {
    switch (this.props.status) {
      case 'ENDED_BY_THERAPIST':
        return 'THERAPIST';
      case 'ENDED_BY_PATIENT':
        return 'PATIENT';
      default:
        return null;
    }
  }

  /** Whole seconds between creation and end, rounded down; null while open. */
  durationSeconds(): number | null {
    if (this.props.endedAt === null) return null;
    const millis =
      this.props.endedAt.getTime() - this.props.createdAt.getTime();
    return Math.max(0, Math.floor(millis / 1000));
  }

  /**
   * Ends the session as the therapist. Returns true when the transition
   * happened, false when it was already ended by the therapist (idempotent).
   * A session ended by the patient answers `session-ended`.
   */
  endByTherapist(now: Date): boolean {
    if (this.props.status === 'ENDED_BY_THERAPIST') return false;
    if (this.props.status !== 'IN_PROGRESS') {
      throw new SessionEndedError('session already ended');
    }
    this.props.status = 'ENDED_BY_THERAPIST';
    this.props.endedAt = now;
    return true;
  }

  snapshot(): SessionProps {
    return { ...this.props };
  }
}

/** A session with the stored-message counts its `stats` are built from. */
export interface SessionWithStats {
  session: Session;
  therapistMessageCount: number;
  patientMessageCount: number;
}
