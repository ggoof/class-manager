import type { FastifyInstance } from 'fastify';
import { audit, createUser, updateUser, users } from '../db.js';
import { currentUser, hashPassword, requireAuth, verifyPassword } from '../auth.js';
import { loginSchema, registerSchema, updateMeSchema } from '../schemas.js';
import { parseOr400, toPublicUser } from '../util.js';
import type { AuthResponse, Role } from '@cm/shared';

export async function authRoutes(app: FastifyInstance) {
  // Public self-registration — always creates an active STUDENT and signs them
  // in. Role is never taken from the request body.
  app.post('/api/auth/register', async (req, reply) => {
    const body = parseOr400(registerSchema, req.body, reply);
    if (!body) return;

    // A friendlier message than the reservation collection's 409, which still
    // backstops this if two identical sign-ups race each other.
    const [byUsername, byEmail] = await Promise.all([
      users.first('username', body.username),
      users.first('email', body.email),
    ]);
    if (byUsername || byEmail) {
      return reply.code(409).send({
        error: byUsername ? 'That username is already taken' : 'That email is already registered',
      });
    }

    const { password, ...profile } = body;
    const user = await createUser({
      username: profile.username,
      passwordHash: await hashPassword(password),
      role: 'STUDENT',
      realName: profile.realName,
      email: profile.email,
      age: profile.age ?? null,
      phone: profile.phone ?? null,
      emergencyContactName: profile.emergencyContactName ?? null,
      emergencyContactPhone: profile.emergencyContactPhone ?? null,
      emergencyContactRelation: profile.emergencyContactRelation ?? null,
      active: true,
    });
    await audit(user.id, 'auth.register', 'User', user.id);

    const token = app.jwt.sign(
      { sub: user.id, username: user.username, role: 'STUDENT' },
      { expiresIn: '12h' },
    );
    const res: AuthResponse = { token, user: toPublicUser(user) };
    return reply.code(201).send(res);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parseOr400(loginSchema, req.body, reply);
    if (!body) return;

    const user = await users.first('username', body.username);
    // Same message for unknown user and bad password so the endpoint can't be
    // used to enumerate usernames.
    const ok = user && (await verifyPassword(body.password, user.passwordHash));
    if (!user || !ok) return reply.code(401).send({ error: 'Incorrect username or password' });
    if (!user.active) return reply.code(403).send({ error: 'This account has been deactivated' });

    const token = app.jwt.sign(
      { sub: user.id, username: user.username, role: user.role as Role },
      { expiresIn: '12h' },
    );
    await audit(user.id, 'auth.login', 'User', user.id);
    return { token, user: toPublicUser(user) };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const me = await users.get(currentUser(req).sub);
    if (!me || !me.active) return reply.code(401).send({ error: 'Not signed in' });
    return toPublicUser(me);
  });

  app.patch('/api/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const body = parseOr400(updateMeSchema, req.body, reply);
    if (!body) return;
    const { sub } = currentUser(req);

    const me = await users.get(sub);
    if (!me) return reply.code(404).send({ error: 'User not found' });

    const { currentPassword, newPassword, ...profile } = body;
    const data: Record<string, unknown> = { ...profile };

    if (newPassword) {
      if (!currentPassword || !(await verifyPassword(currentPassword, me.passwordHash))) {
        return reply.code(400).send({ error: 'Current password is incorrect' });
      }
      data.passwordHash = await hashPassword(newPassword);
    }

    const updated = await updateUser(me, data);
    await audit(sub, 'user.self_update', 'User', sub, Object.keys(data));
    return toPublicUser(updated);
  });
}
