import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: { geneIds: string } }) {
  try {
    const { geneIds } = params;
    const keggIds = geneIds.replace(/,/g, '+');
    const response = await fetch(`https://rest.kegg.jp/get/${keggIds}`);
    const text = await response.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch bulk gene info' }, { status: 500 });
  }
}


