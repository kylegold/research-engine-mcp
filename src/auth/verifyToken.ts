import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import type { Request, Response, NextFunction } from 'express';

const jwksClient = jwksRsa({
  jwksUri: process.env.COMMANDS_JWKS_URL || 'https://api.commands.com/.well-known/jwks.json',
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 5
});

interface JWTPayload {
  sub: string;
  email?: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
}

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  if (!header.kid) {
    return callback(new Error('Missing kid in JWT header'));
  }

  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) {
      return callback(err);
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        issuer: process.env.COMMANDS_JWT_ISSUER || 'https://api.commands.com',
        audience: process.env.COMMANDS_JWT_AUDIENCE || 'research-engine',
        algorithms: ['RS256']
      },
      (err, decoded) => {
        if (err) {
          reject(err);
        } else {
          resolve(decoded as JWTPayload);
        }
      }
    );
  });
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip auth in development if SKIP_AUTH is true
  if (process.env.SKIP_AUTH === 'true' && process.env.NODE_ENV === 'development') {
    req.user = { id: 'dev-user', email: 'dev@example.com' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.substring(7);

  // Verify as JWT
  try {
    const payload = await verifyToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email || ''
    };
    next();
  } catch (error) {
    console.error('JWT verification failed:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
      };
    }
  }
}