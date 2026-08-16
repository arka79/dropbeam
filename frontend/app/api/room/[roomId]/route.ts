import { NextResponse } from 'next/server';

const SIGNALING_URL =
  process.env.NEXT_PUBLIC_SIGNALING_URL ||
  'http://localhost:4000';

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      roomId: string;
    }>;
  },
) {
  try {
    const {
      roomId,
    } = await params;

    if (!roomId) {
      return NextResponse.json(
        {
          error:
            'Room ID is required',
        },
        {
          status: 400,
        },
      );
    }

    const response =
      await fetch(
        `${SIGNALING_URL}/room/${encodeURIComponent(
          roomId,
        )}`,
        {
          cache:
            'no-store',
        },
      );

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            response.status ===
            404
              ? 'Room not found or expired'
              : 'Failed to lookup room',
        },
        {
          status:
            response.status,
        },
      );
    }

    const room =
      await response.json();

    return NextResponse.json(
      room,
    );
  } catch (error) {
    console.error(
      '[Room API]',
      error,
    );

    return NextResponse.json(
      {
        error:
          'Signaling server unreachable',
      },
      {
        status: 503,
      },
    );
  }
}