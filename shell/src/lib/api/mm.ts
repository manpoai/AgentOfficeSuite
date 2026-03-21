/**
 * Mattermost API client — calls through /api/mm/* proxy
 */

const BASE = '/api/mm';

async function mmFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`MM API ${path}: ${res.status}`);
  return res.json();
}

// ── Types ──

export interface MMChannel {
  id: string;
  type: string; // 'O' open, 'P' private, 'D' direct, 'G' group
  display_name: string;
  name: string;
  header: string;
  purpose: string;
  last_post_at: number;
  total_msg_count: number;
  team_id: string;
}

export interface MMPost {
  id: string;
  create_at: number;
  update_at: number;
  delete_at: number;
  message: string;
  user_id: string;
  channel_id: string;
  root_id: string;
  type: string;
  props: Record<string, unknown>;
  metadata?: {
    files?: MMFileInfo[];
  };
}

export interface MMFileInfo {
  id: string;
  name: string;
  extension: string;
  size: number;
  mime_type: string;
}

export interface MMUser {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  nickname: string;
  email: string;
  position: string;
  roles: string;
  last_picture_update: number;
}

export interface MMPostList {
  order: string[];
  posts: Record<string, MMPost>;
}

export interface MMChannelMember {
  channel_id: string;
  user_id: string;
  msg_count: number;
  mention_count: number;
  last_viewed_at: number;
}

// ── API calls ──

export async function getMe(): Promise<MMUser> {
  return mmFetch('/users/me');
}

export async function getUser(userId: string): Promise<MMUser> {
  return mmFetch(`/users/${userId}`);
}

export async function getUsersByIds(userIds: string[]): Promise<MMUser[]> {
  return mmFetch('/users/ids', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userIds),
  });
}

export async function getTeams(): Promise<{ id: string; name: string; display_name: string }[]> {
  return mmFetch('/teams');
}

export async function getMyChannels(teamId: string): Promise<MMChannel[]> {
  return mmFetch(`/users/me/teams/${teamId}/channels`);
}

export async function getMyChannelMembers(teamId: string): Promise<MMChannelMember[]> {
  return mmFetch(`/users/me/teams/${teamId}/channels/members`);
}

export async function getChannelPosts(channelId: string, page = 0, perPage = 60): Promise<MMPostList> {
  return mmFetch(`/channels/${channelId}/posts?page=${page}&per_page=${perPage}`);
}

export async function createPost(channelId: string, message: string, rootId?: string): Promise<MMPost> {
  return mmFetch('/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel_id: channelId, message, root_id: rootId || '' }),
  });
}

export async function getChannel(channelId: string): Promise<MMChannel> {
  return mmFetch(`/channels/${channelId}`);
}

export async function viewChannel(channelId: string): Promise<void> {
  await mmFetch('/channels/members/me/view', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel_id: channelId }),
  });
}

export function getProfileImageUrl(userId: string): string {
  return `${BASE}/users/${userId}/image`;
}

// ── Message operations ──

export async function updatePost(postId: string, message: string): Promise<MMPost> {
  return mmFetch(`/posts/${postId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: postId, message }),
  });
}

export async function deletePost(postId: string): Promise<void> {
  await mmFetch(`/posts/${postId}`, { method: 'DELETE' });
}

// ── Reactions ──

export interface MMReaction {
  user_id: string;
  post_id: string;
  emoji_name: string;
  create_at: number;
}

export async function addReaction(postId: string, emojiName: string): Promise<MMReaction> {
  return mmFetch('/reactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_id: postId, emoji_name: emojiName }),
  });
}

export async function removeReaction(postId: string, emojiName: string, userId: string): Promise<void> {
  await mmFetch(`/users/${userId}/posts/${postId}/reactions/${emojiName}`, { method: 'DELETE' });
}

// ── Channel stats ──

export interface MMChannelStats {
  channel_id: string;
  member_count: number;
  guest_count: number;
}

export async function getChannelStats(channelId: string): Promise<MMChannelStats> {
  return mmFetch(`/channels/${channelId}/stats`);
}

// ── User autocomplete ──

export async function autocompleteUsers(term: string, teamId?: string): Promise<MMUser[]> {
  const params = new URLSearchParams({ name: term });
  if (teamId) params.set('in_team', teamId);
  const data = await mmFetch<{ users: MMUser[] }>(`/users/autocomplete?${params}`);
  return data.users || [];
}

export async function getChannelMembersList(channelId: string): Promise<MMUser[]> {
  const members = await mmFetch<MMChannelMember[]>(`/channels/${channelId}/members?per_page=200`);
  if (members.length === 0) return [];
  const userIds = members.map(m => m.user_id);
  return getUsersByIds(userIds);
}
