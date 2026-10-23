import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentIdentity } from '../../../platform/auth/current-identity.decorator';
import type { AuthenticatedIdentity } from '../../../platform/auth/identity';
import { flowIdOf } from '../../../platform/http/flow-id';
import { toProblem } from '../../../platform/http/problem-details';
import { ListMessages } from '../application/list-messages';
import { SendTherapistMessage } from '../application/send-therapist-message';
import { StreamPatientReply } from '../application/stream-patient-reply';
import { PostMessageRequest } from './dto/message.request';
import {
  MessageListResponse,
  MessageResponse,
  ReplyCompletedEventData,
  ReplyDeltaEventData,
  ReplyStartedEventData,
  SessionEndedEventData,
} from './dto/message.response';
import { ProblemResponse } from './dto/problem.response';
import { SseWriter } from './sse-writer';

const problem = { type: ProblemResponse };

const unauthorized = ApiUnauthorizedResponse({
  ...problem,
  description: '`unauthenticated` or `token-expired`.',
});
const rateLimited = ApiResponse({
  status: 429,
  ...problem,
  description: '`rate-limited`.',
});
const notFound = ApiNotFoundResponse({
  ...problem,
  description: "`session-not-found` (also for another user's session).",
});
const sessionId = ApiParam({
  name: 'session_id',
  description:
    'Opaque session id. A session of another user is reported as not found.',
});

const STREAM_DESCRIPTION = `Requests the patient's reply to the pending message (or the opening message when the session has no messages) and streams it as Server-Sent Events. A \`POST\` because it generates and stores a patient message. No request body. There is no resume or replay: after a failure or a dropped connection nothing of the reply is stored and the client requests the reply again.

The access token is validated when the stream starts only; a token that expires mid-stream does not interrupt it. Problems found before the stream starts (\`session-not-found\`, \`session-ended\`, \`reply-pending\`, \`no-reply-pending\`, 401, 429, 503) are ordinary \`application/problem+json\` responses.

Events (\`event:\` name, then one line of JSON in \`data:\`):

| Event | Data | Meaning |
|---|---|---|
| \`reply.started\` | \`{ "message_id" }\` | Generation has begun. First event of every stream. |
| \`reply.delta\` | \`{ "message_id", "index", "text" }\` | Appended text. \`index\` starts at 0 and grows by 1; concatenate in order. |
| \`reply.completed\` | \`{ "message" }\` | The reply is complete and stored. \`message.text\` equals the concatenated deltas and is authoritative. |
| \`session.ended\` | \`{ "session" }\` | **Reserved, never sent in this milestone.** The patient ended the session; would follow \`reply.completed\`. |
| \`error\` | problem object | Generation failed (\`reply-generation-failed\` 502, or \`service-unavailable\` 503). Nothing of this reply is stored. Last event. |

A comment line \`: keep-alive\` is sent when nothing was sent for 15 s while a reply is generated. The server closes the stream after \`reply.completed\`, \`session.ended\` or \`error\`. A stream that ends without one of these (also when the session is ended or discarded meanwhile) is a failure: the client treats it as interrupted and may try again. No reply is generated for 15 s of silence (\`reply-generation-failed\`). Closing the connection cancels the generation; nothing is stored.

Replies are at most 2,500 characters; a longer reply fails as \`reply-generation-failed\` and nothing is stored. The response carries \`Cache-Control: no-store\` and \`X-Accel-Buffering: no\`.`;

@ApiTags('chat-simulation')
@ApiExtraModels(
  ReplyStartedEventData,
  ReplyDeltaEventData,
  ReplyCompletedEventData,
  SessionEndedEventData,
  ProblemResponse,
)
@Controller('sessions/:session_id')
export class MessagesController {
  private readonly logger = new Logger('PatientReply');

  constructor(
    private readonly sendMessage: SendTherapistMessage,
    private readonly listMessages: ListMessages,
    private readonly streamReply: StreamPatientReply,
  ) {}

  @Post('messages')
  @sessionId
  @ApiOperation({
    summary: "Store the therapist's message",
    description:
      "Allowed only while the session is in progress and the last stored message is the patient's. The reply is requested separately with `patient-replies`.",
  })
  @ApiCreatedResponse({ type: MessageResponse })
  @ApiBadRequestResponse({
    ...problem,
    description:
      '`invalid-request` on `text`: `REQUIRED`, `INVALID_TYPE`, `TOO_SHORT` (empty after trimming) or `TOO_LONG`.',
  })
  @unauthorized
  @notFound
  @ApiConflictResponse({
    ...problem,
    description:
      '`session-ended`, or `reply-pending` (a reply is being generated or the last therapist message is still unanswered).',
  })
  @rateLimited
  async post(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('session_id') id: string,
    @Body() body: PostMessageRequest,
  ): Promise<MessageResponse> {
    return MessageResponse.from(
      await this.sendMessage.execute(identity.uid, id, body.text),
    );
  }

  @Get('messages')
  @sessionId
  @ApiOperation({
    summary: 'List the stored messages',
    description:
      'Only completed messages, in ascending `created_at` order. Used to reconcile after a failed or interrupted reply.',
  })
  @ApiOkResponse({ type: MessageListResponse })
  @unauthorized
  @notFound
  @rateLimited
  async list(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('session_id') id: string,
  ): Promise<MessageListResponse> {
    const items = await this.listMessages.execute(identity.uid, id);
    return { items: items.map((message) => MessageResponse.from(message)) };
  }

  @Post('patient-replies')
  @HttpCode(200)
  @sessionId
  @ApiOperation({
    summary: "Stream the patient's reply",
    description: STREAM_DESCRIPTION,
  })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description:
      'A `text/event-stream`. See the operation description for the events.',
    headers: {
      'Cache-Control': { schema: { type: 'string', example: 'no-store' } },
      'X-Accel-Buffering': { schema: { type: 'string', example: 'no' } },
    },
    content: {
      'text/event-stream': {
        schema: {
          type: 'string',
          description:
            'Frames of `event:` and `data:` lines. Data schemas: ' +
            [
              ReplyStartedEventData,
              ReplyDeltaEventData,
              ReplyCompletedEventData,
              SessionEndedEventData,
            ]
              .map((model) => getSchemaPath(model))
              .join(', '),
        },
        example:
          'event: reply.started\ndata: {"message_id":"m1"}\n\n' +
          'event: reply.delta\ndata: {"message_id":"m1","index":0,"text":"Hello"}\n\n' +
          ': keep-alive\n\n' +
          'event: reply.completed\ndata: {"message":{"id":"m1","role":"PATIENT","text":"Hello","created_at":"2026-01-01T10:00:00.000Z"}}\n\n',
      },
    },
  })
  @unauthorized
  @notFound
  @ApiConflictResponse({
    ...problem,
    description:
      "`session-ended`; `reply-pending` (a generation for this session is already in progress); or `no-reply-pending` (the last message is already the patient's: reconcile with `GET .../messages`).",
  })
  @rateLimited
  @ApiResponse({
    status: 503,
    ...problem,
    description: '`service-unavailable`.',
  })
  async reply(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('session_id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    // Anything wrong is thrown here, before a byte of the stream is written,
    // and becomes an ordinary problem response.
    const run = await this.streamReply.execute(identity.uid, id);

    const flowId = flowIdOf(response) ?? '';
    const instance = request.originalUrl.split('?')[0];
    const startedAt = performance.now();
    let writer: SseWriter | undefined;
    let outcome = 'cancelled';
    let errorClass: string | undefined;
    let deltas = 0;
    let keepAlives = 0;
    let firstDeltaMs: number | undefined;

    // A client that goes away cancels the generation; nothing is stored.
    response.on('close', () => {
      if (!response.writableFinished) run.close();
    });

    if (response.destroyed) run.close();

    try {
      const sse = new SseWriter(response);
      writer = sse;
      sse.open();
      for await (const event of run.events) {
        // The outcome is a fact about the reply, whether or not the client
        // is still there to receive it.
        if (event.type === 'completed') outcome = 'completed';
        if (event.type === 'error') {
          outcome = event.code;
          errorClass = event.errorClass;
        }
        if (sse.closed) break;
        switch (event.type) {
          case 'started':
            await sse.event('reply.started', {
              message_id: event.messageId,
            });
            break;
          case 'delta':
            deltas += 1;
            firstDeltaMs ??= Math.round(performance.now() - startedAt);
            await sse.event('reply.delta', {
              message_id: event.messageId,
              index: event.index,
              text: event.text,
            });
            break;
          case 'keep-alive':
            keepAlives += 1;
            await sse.comment('keep-alive');
            break;
          case 'completed':
            await sse.event('reply.completed', {
              message: MessageResponse.from(event.message),
            });
            break;
          case 'error':
            await sse.event('error', toProblem(event.code, instance, flowId));
            break;
        }
      }
    } catch (error) {
      // The headers are out, so the stream just ends; the client sees an
      // interrupted stream and may try again.
      outcome = 'interrupted';
      errorClass = error instanceof Error ? error.constructor.name : 'Unknown';
    } finally {
      run.close();
      writer?.end();
      // Counts and timings only: never message text.
      this.logger.log(
        JSON.stringify({
          event: 'patient_reply_stream',
          flow_id: flowId,
          session_id: id,
          outcome,
          error_class: errorClass,
          deltas,
          keep_alives: keepAlives,
          first_delta_ms: firstDeltaMs,
          duration_ms: Math.round(performance.now() - startedAt),
        }),
      );
    }
  }
}
