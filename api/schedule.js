// api/schedule.js — Buffer GraphQL API direct

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

  // First — introspect to find the correct mutation name and types
  // This tells us exactly what Buffer's API accepts
  const introspectQuery = `
    query {
      __schema {
        mutationType {
          fields {
            name
            args {
              name
              type {
                name
                kind
                ofType { name kind }
              }
            }
          }
        }
      }
    }
  `;

  try {
    // First call — discover the correct mutation
    const introspectRes = await fetch('https://api.buffer.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BUFFER_API_KEY}`,
      },
      body: JSON.stringify({ query: introspectQuery }),
    });

    const introspectData = await introspectRes.json();
    const mutations = introspectData?.data?.__schema?.mutationType?.fields || [];
    const mutationNames = mutations.map(m => m.name);
    console.log('Available mutations:', mutationNames.join(', '));

    // Find the create post mutation
    const createPostMutation = mutations.find(m =>
      m.name.toLowerCase().includes('create') &&
      m.name.toLowerCase().includes('post')
    );
    console.log('Create post mutation found:', createPostMutation?.name);

    // Now try the correct Buffer API approach — using their v2 REST API
    // which is more stable than GraphQL beta
    const results = await Promise.all(
      selectedChannels.map(async ({ platform, id }) => {
        try {
          // Try Buffer's REST API v2
          const r = await fetch(`https://api.bufferapp.com/1/updates/create.json`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              access_token: BUFFER_API_KEY,
              profile_ids: id,
              text: caption,
              scheduled_at: scheduledAt,
              ...(imageUrls[0] && { 'media[photo]': imageUrls[0] }),
            }),
          });

          const data = await r.json();
          console.log(`Buffer v1 ${platform} response:`, JSON.stringify(data).slice(0, 300));

          if (data.error) {
            // Try GraphQL with corrected schema
            const mutation = `
              mutation {
                createPost(input: {
                  profileId: "${id}",
                  content: {
                    text: ${JSON.stringify(caption)},
                    media: [${imageUrls.map(url => `{url: ${JSON.stringify(url)}}`).join(',')}]
                  },
                  scheduledAt: "${scheduledAt}"
                }) {
                  ... on PostActionSuccess {
                    post {
                      id
                      status
                    }
                  }
                  ... on PostActionError {
                    message
                    code
                  }
                }
              }
            `;

            const gqlRes = await fetch('https://api.buffer.com/graphql', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BUFFER_API_KEY}`,
              },
              body: JSON.stringify({ query: mutation }),
            });

            const gqlData = await gqlRes.json();
            console.log(`Buffer GQL ${platform} response:`, JSON.stringify(gqlData).slice(0, 300));

            if (gqlData.errors) {
              return { platform, success: false, error: gqlData.errors[0]?.message };
            }
            return { platform, success: true };
          }

          return { platform, success: true, updateId: data.updates?.[0]?.id };

        } catch (err) {
          console.error(`Buffer ${platform} error:`, err.message);
          return { platform, success: false, error: err.message };
        }
      })
    );

    const succeeded = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log('Final results:', JSON.stringify(results));

    if (succeeded.length > 0) {
      return res.status(200).json({
        success: true,
        message: `Scheduled to ${succeeded.map(r => r.platform).join(', ')} successfully.`,
        results,
        scheduledAt,
        failed: failed.length ? failed : undefined,
      });
    } else {
      return res.status(500).json({
        error: 'Failed to schedule to any platform',
        results,
        availableMutations: mutationNames,
      });
    }

  } catch (err) {
    console.error('Schedule error:', err.message);
    return res.status(500).json({ error: 'Failed to schedule', detail: err.message });
  }
};
