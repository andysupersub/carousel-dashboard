// api/schedule.js — Vercel Serverless Function (CommonJS)

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

  // Schedule to each platform separately via Buffer API directly
  // This is faster than going through Claude MCP
  const results = [];
  const errors = [];

  for (const channelId of selectedChannelIds) {
    try {
      // Use Buffer API directly — much faster than MCP via Claude
      const bufferRes = await fetch('https://api.bufferapp.com/1/updates/create.json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          access_token: BUFFER_API_KEY,
          profile_ids: channelId,
          text: caption,
          scheduled_at: scheduledAt,
          media: JSON.stringify({ photo: imageUrls[0] }),
        }),
      });

      const bufferData = await bufferRes.json();
      console.log('Buffer response for channel', channelId, ':', JSON.stringify(bufferData).slice(0, 200));

      if (bufferRes.ok) {
        results.push({ channelId, success: true });
      } else {
        errors.push({ channelId, error: bufferData });
      }
    } catch (err) {
      console.error('Buffer error for channel', channelId, err.message);
      errors.push({ channelId, error: err.message });
    }
  }

  if (results.length > 0) {
    return res.status(200).json({
      success: true,
      message: `Scheduled to ${results.length} platform(s) successfully.`,
      results,
      errors: errors.length ? errors : undefined,
      platforms,
      scheduledAt,
    });
  } else {
    return res.status(500).json({
      error: 'Failed to schedule to any platform',
      errors,
    });
  }
};
