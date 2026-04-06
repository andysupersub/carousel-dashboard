module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { caption, imageUrls, platforms, scheduledAt } = req.body;
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

  // Find all possible return types of createPost mutation
  const introRes = await fetch('https://api.buffer.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BUFFER_API_KEY}` },
    body: JSON.stringify({ query: `
      query {
        createPostReturn: __type(name: "CreatePostPayload") {
          kind name
          possibleTypes { name }
        }
        mutationType: __schema {
          mutationType {
            fields(includeDeprecated: true) {
              name
              type { name kind ofType { name kind possibleTypes { name } } }
            }
          }
        }
      }
    `}),
  });
  const introData = await introRes.json();
  console.log('CreatePostPayload:', JSON.stringify(introData?.data?.createPostReturn));

  // Find createPost mutation return type
  const createPostField = introData?.data?.mutationType?.mutationType?.fields?.find(f => f.name === 'createPost');
  console.log('createPost return type:', JSON.stringify(createPostField?.type));

  // Try mutation WITHOUT inline fragment — get raw response
  const testChannel = selectedChannels[0];
  const rawMutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input)
    }
  `;

  const variables = {
    input: {
      channelId: testChannel.id,
      schedulingType: 'automatic',
      dueAt: scheduledAt,
      text: caption,
      mode: 'customScheduled',
      assets: { images: imageUrls.map(url => ({ url })) },
    }
  };

  const rawRes = await fetch('https://api.buffer.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BUFFER_API_KEY}` },
    body: JSON.stringify({ query: rawMutation, variables }),
  });
  const rawData = await rawRes.json();
  console.log('Raw createPost response:', JSON.stringify(rawData));

  return res.status(200).json({
    debug: true,
    introData: introData?.data,
    rawResponse: rawData,
  });
};
