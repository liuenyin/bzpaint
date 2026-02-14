import { io, Socket } from "socket.io-client";
import { SOCKET_URL } from "./constants";
import { ServerToClientEvents, ClientToServerEvents } from "./types";

/**https://socket.io/how-to/use-with-react#example */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  SOCKET_URL,
  {
    reconnectionDelayMax: 10000,
    autoConnect: false,
    withCredentials: true,
    transports: ["websocket", "polling"],
  }
);
