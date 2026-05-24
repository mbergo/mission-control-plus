import { NextResponse } from 'next/server'
import { config } from '@/lib/config'

/**
 * GET /api/personal/mode
 * Public endpoint that returns the configured deployment mode so the SPA
 * can decide which nav and home panel to render.
 */
export async function GET() {
  return NextResponse.json({
    mode: config.mcMode,
    personalAiLocalOnly: config.personalAiLocalOnly,
  })
}
