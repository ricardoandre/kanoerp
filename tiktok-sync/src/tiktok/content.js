import axios from "axios";
import { CONTENT_API_BASE } from "./contentAuth.js";

/**
 * Pull the client's recent organic video list with engagement metrics.
 * TikTok's video.list scope returns up to 20 videos per page (cursor-paginated).
 */
export async function fetchContentPerformance({ accessToken, openId, maxVideos = 50 }) {
  const fields = [
    "id",
    "title",
    "video_description",
    "create_time",
    "cover_image_url",
    "share_url",
    "view_count",
    "like_count",
    "comment_count",
    "share_count",
  ].join(",");

  let cursor = 0;
  let hasMore = true;
  const results = [];

  while (hasMore && results.length < maxVideos) {
    const res = await axios.post(
      `${CONTENT_API_BASE}/video/list/?fields=${fields}`,
      { max_count: 20, cursor },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );

    const data = res.data.data;
    for (const v of data.videos || []) {
      results.push({
        open_id: openId,
        video_id: v.id,
        title: v.title || v.video_description || "",
        posted_at: new Date(v.create_time * 1000).toISOString(),
        share_url: v.share_url,
        views: v.view_count || 0,
        likes: v.like_count || 0,
        comments: v.comment_count || 0,
        shares: v.share_count || 0,
        engagement_rate:
          v.view_count > 0
            ? ((v.like_count || 0) + (v.comment_count || 0) + (v.share_count || 0)) / v.view_count
            : 0,
      });
    }

    hasMore = data.has_more;
    cursor = data.cursor;
  }

  return results;
}
