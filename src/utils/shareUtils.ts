import { publicPath } from '@/lib/utils';
export const handleTwitterShare = (conversationId: string) => {
  const shareUrl = `${window.location.origin}${publicPath(`share/${conversationId}`)}`;
  const text = 'Check out what I created with GEXUS!';
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`,
    '_blank',
    'noopener,noreferrer',
  );
};

export const handleFacebookShare = (conversationId: string) => {
  const shareUrl = `${window.location.origin}${publicPath(`share/${conversationId}`)}`;
  window.open(
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    '_blank',
    'noopener,noreferrer',
  );
};

export const handleWhatsAppShare = (conversationId: string) => {
  const shareUrl = `${window.location.origin}${publicPath(`share/${conversationId}`)}`;
  const text = 'Check out what I created with GEXUS!';
  window.open(
    `https://wa.me/?text=${encodeURIComponent(text + ' ' + shareUrl)}`,
    '_blank',
    'noopener,noreferrer',
  );
};
