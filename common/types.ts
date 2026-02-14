export type UserType = "Basic" | "Admin" | "Guest";

export interface User {
  id: string;
  type: UserType;
  email: string;
  username: string;
  tokens?: number;
  remark?: string;
  password?: string; // Optional because we don't always fetch it
}

export interface Pixel {
  position: number;
  timestamp: Date;
  author: string;
  color: string;
}

export interface loginDetails {
  email: string;
  password: string;
}

// ------- start of socketio types ----------
// Reference: https://socket.io/docs/v4/typescript/#types-for-the-server

/**
 * A minimalPixel is sent to server and remaining pixel attributes are added by server.
 */
export interface minimalPixel {
  position: number;
  color: string;
}

/**
 * Used when sending and broadcasting events on server or when receiving events on client.
 */
export interface ServerToClientEvents {
  messageResponse: (a: Pixel) => void;
  limitExceeded: (data: { remaining: number }) => void; // user exceeded drawing limit
  resetCanvasResponse: () => void; // client is asked to clear his local canvas
  onlineUsernames: (a: string[]) => void; // array of names of online users
  tokenUpdate: (data: { tokens: number }) => void; // update user token count
}

/**
 * Used when receiving events on server or when sending events from client
 */
export interface ClientToServerEvents {
  message: (pixel: minimalPixel) => void; // send minimum info to server about pixel to be updated
  batchMessage: (data: { pixels: minimalPixel[] }) => void; // batch pixel updates for AutoPaint
  resetCanvas: () => void; // request server to reset canvas. server may refuse request.
}

// ------- end of socketio types ----------
