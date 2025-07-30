import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development';

export function createLogger(name: string) {
  return pino({
    name,
    level: process.env.LOG_LEVEL || 'info',
    ...(isDev && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          translateTime: 'HH:MM:ss'
        }
      }
    })
  });
}

export const logger = createLogger('research-engine');