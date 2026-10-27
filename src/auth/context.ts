import { createContext } from 'react'
import type { SessionRuntime } from './session.ts'

export const SessionContext = createContext<SessionRuntime | null>(null)
