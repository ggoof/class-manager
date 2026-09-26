import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@cm/shared';

export interface TokenPayload {
  sub: string;
  username: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by `requireAuth`. */
    auth?: TokenPayload;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

/** Verifies the bearer token and attaches the payload to the request. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    req.auth = await req.jwtVerify<TokenPayload>();
  } catch {
    return reply.code(401).send({ error: 'Not signed in' });
  }
}

/** Use after `requireAuth`. Rejects anyone outside the listed roles. */
export function requireRole(...roles: Role[]) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    if (!req.auth) return reply.code(401).send({ error: 'Not signed in' });
    if (!roles.includes(req.auth.role)) {
      return reply.code(403).send({ error: 'Your role cannot perform this action' });
    }
  };
}

/** Convenience for handlers that have already passed `requireAuth`. */
export function currentUser(req: FastifyRequest): TokenPayload {
  if (!req.auth) throw new Error('currentUser called on an unauthenticated request');
  return req.auth;
}
