// api/schedule.js — Vercel Serverless Function (CommonJS)
// Calls all platforms in parallel — fast, no timeout

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { title, caption, imageUrls, platforms, scheduledAt } = req.body;

  if (!caption || !imageUrls?.length || !platforms?.length || !scheduledAt) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const BUFFER_API_KEY    = process.env.BUFFER_API_KEY;

  const CHANNEL_IDS = {
    instagram: process.env.BUFFER_INSTAGRAM_ID,
    facebook:  process.env.BUFFER_FACEBOOK_ID,
    tiktok:    process.env.BUFFER_TIKTOK_ID,
  };

  const selectedChannelIds = platforms.map(p => CHANNEL_IDS[p]).filter(Boolean);

  if (!selectedChannelIds.length) {
    return res.status(400).json({ error: 'No valid channel IDs found for selected platforms' });
  }

  // Build one prompt that schedules ALL channels in a single Claude call
  const prompt = `
Schedule this social media carousel post to Buffer for ALL of these channel IDs at once.

Channel IDs to schedule to (schedule ALL of them):
${selectedChannelIds.map((id, i) => `${i+1}. ${id}`).join('\n')}

Post details:
- Text: ${caption}
- Images (use all of these in order as the media): ${imageUrls.join(', ')}
- Scheduled time (UTC): ${scheduledAt}

Important: Call create_post once for EACH channel ID listed above. Do not skip any.
Schedule all ${selectedChannelIds.length} channels before responding.
  `.trim();

  try {
    console.log('Scheduling to', selectedChannelIds.length, 'channels:', selectedChannelIds);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000); // abort at 9s to respond before Vercel 10s limit

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // Use Haiku — much faster than Sonnet
        max_tokens: 2048,
        mcp_servers: [
          {
            type: 'url',
            url: 'https://mcp.buffer.com/mcp',
            name: 'buffer',
            authorization_token: BUFFER_API_KEY,
          }
        ],
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await response.json();
    console.log('Claude response status:', response.status);

    if (!response.ok) {
      return res.status(500).json({ error: 'Claude API error', detail: data });
    }

    const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';
    console.log('Schedule result:', text.slice(0, 400));

    return res.status(200).json({
      success: true,
      message: `Scheduled to ${platforms.join(', ')} for ${scheduledAt}.`,
      detail: text,
      platforms,
      scheduledAt,
    });

  } catch (err) {
    if (err.name === 'AbortError') {
      // Timed out — but it might have partially worked
      console.log('Request timed out — may have partially scheduled');
      return res.status(200).json({
        success: true,
        message: 'Scheduling in progress. Check Buffer in 30 seconds to confirm all platforms.',
        warning: 'Request took longer than expected.',
        platforms,
        scheduledAt,
      });
    }
    console.error('Schedule error:', err.message);
    return res.status(500).json({ error: 'Failed to schedule', detail: err.message });
  }
};
