import { io, Socket } from 'socket.io-client'
import { resolveApiBaseUrl } from './api'

let _socket: Socket | null = null
let _refCount = 0

export function acquireSocket(): Socket {
  if (!_socket) {
    // Resolve the socket URL the same way REST fetches do, so VITE_SOCKET_URL /
    // VITE_API_URL / same-origin fallback all work automatically.
    const socketUrl =
      import.meta.env.VITE_SOCKET_URL ??
      (typeof window !== 'undefined' ? resolveApiBaseUrl() : '')
    _socket = io(socketUrl, {
      // withCredentials sends the HttpOnly auth cookie automatically.
      // The legacy auth.token field is omitted — cookie handles auth.
      withCredentials: true,
      // Start with polling so the connection works behind Cloudflare (which
      // sometimes drops the WS upgrade), then upgrade to WebSocket when able.
      transports: ['polling', 'websocket'],
    })
  }
  _refCount++
  return _socket
}

export function releaseSocket(): void {
  _refCount = Math.max(0, _refCount - 1)
  if (_refCount === 0) {
    _socket?.disconnect()
    _socket = null
  }
}
