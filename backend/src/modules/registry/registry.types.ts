export interface ServiceActor {
  userId: string;
  username: string;
  displayName?: string;
}

export function actorName(actor: ServiceActor): string {
  return actor.displayName?.trim() || actor.username;
}
