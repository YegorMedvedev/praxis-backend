export interface DomainEvent {
  /** Stable event name, e.g. `users.user-provisioned`. */
  readonly name: string;
  readonly occurredAt: Date;
}

export interface DomainEventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
