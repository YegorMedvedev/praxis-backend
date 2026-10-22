import { Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

interface RouteLayer {
  match(path: string): boolean;
  route?: { methods: Record<string, boolean | undefined> };
}

/** The slice of the Express router this component reads. */
export interface RouterLike {
  stack: RouteLayer[];
}

/**
 * Methods the application serves for a path, used to turn "route not found"
 * into 405 with `Allow` when the path exists under other methods.
 * Returns an empty list when the path is unknown or answers every method.
 */
export function allowedMethodsFor(router: RouterLike, path: string): string[] {
  const methods = new Set<string>();
  for (const layer of router.stack) {
    if (!layer.route || !layer.match(path)) continue;
    if (layer.route.methods._all) return [];
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (enabled) methods.add(method.toUpperCase());
    }
  }
  return [...methods].sort();
}

@Injectable()
export class RouteMethods {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  allowedFor(path: string): string[] {
    const app = this.adapterHost.httpAdapter?.getInstance() as
      { router?: RouterLike } | undefined;
    return app?.router ? allowedMethodsFor(app.router, path) : [];
  }
}
