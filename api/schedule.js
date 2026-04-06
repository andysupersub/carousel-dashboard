// api/schedule.js — introspect SchedulingType enum first

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

  const BUFFER_API_KEY = process.env.BUFFER_API_KEY;

  const CHANNEL_IDS = {
    instagram: process.env.BUFFER_INSTAGRAM_ID,
    facebook:  process.env.BUFFER_FACEBOOK_ID,
    tiktok:    process.env.BUFFER_TIKTOK_ID,
  };

  const selectedChannels = platforms
    .map(p => ({ platform: p, id: CHANNEL_IDS[p] }))
    .filter(c => c.id);

  if (!selectedChannels.length) {
    return res.status(400).json({ error: 'No valid channel IDs found' });
  }

  // Step 1 — introspect SchedulingType and CreatePostInput to get exact field names
  const introspectQuery = `
    query {
      schedulingType: __type(name: "SchedulingType") {
        enumValues { name }
      }
      createPostInput: __type(name: "CreatePostInput") {
        inputFields {
          name
          type {
            name
            kind
            ofType { name kind }
          }
        }
      }
    }
  `;

  const introRes = await fetch('https://api.buffer.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BUFFER_API_KEY}`,
    },
    body: JSON.stringify({ query: introspectQuery }),
  });

  const introData = await introRes.json();
  const schedulingEnums = introData?.data?.schedulingType?.enumValues?.map(e => e.name) || [];
  const inputFields = introData?.data?.createPostInput?.inputFields?.map(f => f.name) || [];

  console.log('SchedulingType enum values:', schedulingEnums);
  console.log('CreatePostInput fields:', inputFields);

  // Return this info so we can see it in the response too
  return res.status(200).json({
    success: false,
    debug: true,
    schedulingEnums,
    inputFields,
    message: 'Debug info — check schedulingEnums and inputFields to fix the mutation',
  });
};
