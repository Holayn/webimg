import winston from 'winston';
import path from 'path';
import { mkdirSync } from 'node:fs';

const logFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:SS' }),
  winston.format.align(),
  winston.format.printf(
    ({ level, message, timestamp, stack, ...meta }) => {
      let output = `${timestamp} ${level}: ${message}`;
      // Check if meta has any keys and stringify it
      if (Object.keys(meta).length > 0) {
        output += ` ${JSON.stringify(meta)}`;
      }
      if (stack) {
        output += `\n${stack}\n`;
      }
      return output;
    }
  )
);

export class Logger {
  private logger: winston.Logger;
  private closed: boolean = false;

  constructor(logPath: string) {
    const normalizedPath = path.normalize(logPath);
    mkdirSync(normalizedPath, { recursive: true });

    const fileTransport = new winston.transports.File({
      dirname: normalizedPath,
      filename: path.join('webimg.log'),
      level: 'info',
    }).on('error', (error) => {
      console.error('Error writing to log file:', error);
    });

    const debugFileTransport = new winston.transports.File({
      dirname: normalizedPath,
      filename: path.join('webimg-debug.log'),
      level: 'debug',
      format: winston.format((info) => {
        // Only include 'debug' logs in this file
        if (info.level === 'debug') {
          return info;
        }
        return false; // Exclude all other levels
      })(),
    }).on('error', (error) => {
      console.error('Error writing to debug log file:', error);
    });

    this.logger = winston.createLogger({
      level: 'debug',
      format: logFormat,
      transports: [
        new winston.transports.Console({
          level: 'info',
        }),
        fileTransport,
        debugFileTransport,
      ]
    });
  }

  log(message: any, meta?: any) {
    if (this.closed) {
      return;
    }

    this.logger.info(message, meta);
  }

  debug(message: any, meta?: any) {
    if (this.closed) {
      return;
    }
    
    this.logger.debug(message, meta);
  }

  error(message: any, meta?: any) {
    if (this.closed) {
      console.error(message);
    }

    if (message instanceof Error) {
      // If message is an Error, pass its string `message` as the main message
      // and pass the original Error object inside the meta object.
      // This preserves both the stack (for format.errors) and the meta.
      this.logger.error(message.message, { ...meta, cause: message.cause, stack: message.stack });
    } else {
      // Message is a string, pass it normally.
      this.logger.error(message, meta);
    }
  }

  async done() {
    this.closed = true;
    
    return new Promise<void>((resolve, reject) => {
      const errorListener = (err: Error) => {
        reject(err);
      };
      this.logger.on('error', errorListener);

      // Listen for successful finish
      this.logger.on('finish', () => {
        this.logger.removeListener('error', errorListener); // Clean up listener
        resolve();
      });

      // Start closing the logger
      this.logger.end();
    });
  }
}