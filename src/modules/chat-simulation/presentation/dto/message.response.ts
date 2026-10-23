import { ApiProperty } from '@nestjs/swagger';
import type { Message } from '../../domain/message';
import { SessionResponse } from './session.response';
import { ProblemResponse } from './problem.response';

export class MessageResponse {
  @ApiProperty({ description: 'Opaque id.' }) id!: string;
  @ApiProperty({ enum: ['THERAPIST', 'PATIENT'] }) role!: string;
  @ApiProperty() text!: string;
  @ApiProperty({
    format: 'date-time',
    description:
      'RFC 3339 UTC. For a patient message, the time the reply completed.',
  })
  created_at!: string;

  static from(message: Message): MessageResponse {
    return {
      id: message.id,
      role: message.role,
      text: message.text,
      created_at: message.createdAt.toISOString(),
    };
  }
}

export class MessageListResponse {
  @ApiProperty({
    type: [MessageResponse],
    description: 'Ascending `created_at`. No pagination.',
  })
  items!: MessageResponse[];
}

// Payloads of the server-sent events, documented as schemas (`data:` lines).

export class ReplyStartedEventData {
  @ApiProperty() message_id!: string;
}

export class ReplyDeltaEventData {
  @ApiProperty() message_id!: string;
  @ApiProperty({ type: 'integer', minimum: 0 }) index!: number;
  @ApiProperty() text!: string;
}

export class ReplyCompletedEventData {
  @ApiProperty({ type: MessageResponse }) message!: MessageResponse;
}

export class SessionEndedEventData {
  @ApiProperty({ type: SessionResponse }) session!: SessionResponse;
}

export { ProblemResponse as ReplyErrorEventData };
