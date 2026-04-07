// api/schedule.js — Buffer GraphQL API (Carousels + Videos)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { caption, imageUrls, videoUrl, platforms, scheduledAt, type } = req.body;

  if (!caption || !platforms?.length || !scheduledAt) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Videos require either a videoUrl or a thumbnail; carousels require imageUrls
  if (type === 'video' && !videoUrl && !imageUrls?.length) {
    return res.status(400).json({ error: 'Video post requires videoUrl or imageUrls (thumbnail)' });
  }
  if (type !== 'video' && !imageUrls?.length) {
    return res.status(400).json({ error: 'Carousel post requires imageUrls' });
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

  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          post { id status dueAt }
        }
        ... on NotFoundError { message }
        ... on UnauthorizedError { message }
        ... on UnexpectedError { message }
        ... on RestProxyError { message }
        ... on LimitReachedError { message }
        ... on InvalidInputError { message }
      }
    }
  `;

  const results = await Promise.all(
    selectedChannels.map(async ({ platform, id }) => {
      try {
        let metadata = {};
        if (platform === 'instagram') {
          metadata = { instagram: { type: 'post', shouldShareToFeed: true } };
        } else if (platform === 'facebook') {
          metadata = { facebook: { type: 'post' } };
        }

        // Build assets — video post uses video asset if available, otherwise falls back to images
        let assets = {};
        if (type === 'video' && videoUrl) {
          assets = { video: { url: videoUrl } };
        } else if (imageUrls?.length) {
          assets = { images: imageUrls.map(url => ({ url })) };
        }

        const variables = {
          input: {
            channelId: id,
            schedulingType: 'automatic',
            dueAt: scheduledAt,
            text: caption,
            mode: 'customScheduled',
            assets,
            ...(Object.keys(metadata).length ? { metadata } : {}),
          }
        };

        const r = await fetch('https://api.buffer.com/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${BUFFER_API_KEY}`,
          },
          body: JSON.stringify({ query: mutation, variables }),
        });

        const data = await r.json();
        console.log(`Buffer ${platform}:`, JSON.stringify(data));

        if (data.errors) {
          return { platform, success: false, error: data.errors[0]?.message };
        }

        const result = data.data?.createPost;
        if (result?.post) {
          return { platform, success: true, postId: result.post.id, status: result.post.status };
        } else if (result?.message) {
          return { platform, success: false, error: result.message };
        } else if (result && Object.keys(result).length === 0) {
          return { platform, success: true, note: 'Post created' };
        }

        return { platform, success: false, error: 'Unknown response' };

      } catch (err) {
        return { platform, success: false, error: err.message };
      }
    })
  );

  console.log('Final:', JSON.stringify(results));

  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  if (succeeded.length > 0) {
    return res.status(200).json({
      success: true,
      message: `Scheduled to ${succeeded.map(r => r.platform).join(', ')} successfully.`,
      results,
      scheduledAt,
      failed: failed.length ? failed : undefined,
    });
  } else {
    return res.status(500).json({ error: 'Failed to schedule to any platform', results });
  }
};
