import { useProfile, useAvatarUrl } from '@/services/profileService';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

export function UserAvatar({ className }: { className?: string }) {
  const { data: profile } = useProfile();
  const { data: uploadedAvatarUrl } = useAvatarUrl(profile?.avatar_path);
  const { account, isSignedIn, displayName } = useAuth();

  // An avatar the person uploaded here beats the one Google has on file: they
  // chose it deliberately and more recently.
  const src = uploadedAvatarUrl || (isSignedIn ? account?.photoURL : null);
  const name = isSignedIn
    ? profile?.full_name || displayName
    : profile?.full_name || null;

  return (
    <Avatar className={className}>
      <AvatarImage src={src || undefined} referrerPolicy="no-referrer" />
      <AvatarFallback>{getInitials(name)}</AvatarFallback>
    </Avatar>
  );
}
