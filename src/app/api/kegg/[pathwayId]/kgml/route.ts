import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest, ctx: { params: Promise<{ pathwayId: string }> }) {
  try {
    const { pathwayId } = await ctx.params;
    const response = await fetch(`https://rest.kegg.jp/get/${pathwayId}/kgml`);
    const xml = await response.text();
    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch KGML' }, { status: 500 });
  }
}


