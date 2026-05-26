import { io } from "socket.io-client";

const SOCKET_URL = `${window.location.protocol}//${window.location.hostname}:3000`;

export const socket = io(SOCKET_URL, {
  autoConnect: false,
});
