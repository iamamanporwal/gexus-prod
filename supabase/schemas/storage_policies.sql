-- Storage policies without authentication.
--
-- Upstream scoped every bucket to the signed-in user by matching the first
-- path segment against auth.uid(). This build has no authentication, so
-- auth.uid() is always NULL and those policies would deny every object.
--
-- Uploads still write under the local user's id (see shared/localUser.ts) so
-- the existing `<user_id>/<conversation_id>/...` layout is unchanged — nothing
-- verifies the prefix any more, it is just a folder name.
CREATE POLICY "Local access to app buckets" ON storage.objects
  FOR ALL TO public
  USING (bucket_id IN ('images', 'meshes', 'previews', 'temp-multiview'))
  WITH CHECK (bucket_id IN ('images', 'meshes', 'previews', 'temp-multiview'));
