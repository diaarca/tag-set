export async function catalogRequest(value) {
  if (
    !value ||
    !['search', 'next', 'browse'].includes(value.endpoint) ||
    !value.body ||
    typeof value.body !== 'object' ||
    Array.isArray(value.body)
  )
    throw new Error('Invalid catalog request.');
  const version = `1.${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.01.00`;
  const body = JSON.stringify({
    ...value.body,
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: version,
        hl: 'en',
        gl: 'US',
      },
    },
  });
  if (Buffer.byteLength(body) > 65_536)
    throw new Error('The catalog request is too large.');
  const response = await fetch(
    `https://music.youtube.com/youtubei/v1/${value.endpoint}?prettyPrint=false`,
    {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(45_000),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://music.youtube.com',
        'X-YouTube-Client-Name': '67',
        'X-YouTube-Client-Version': version,
      },
    },
  );
  if (!response.ok)
    throw new Error(
      'YouTube Music could not return this information. Check that the link is public.',
    );
  const result = await response.json();
  if (!result || typeof result !== 'object' || result.error)
    throw new Error('YouTube Music returned an unreadable response.');
  return result;
}
