declare global {
  interface Liveblocks {
    Presence: {
      viewingSection: string | null;
    };
    Storage: {
      gapPosted: boolean;
      ownerId: string;
      docTitle: string;
      planJson: string;
      planLines: string[];
      chatMessages: { role: string; content: string }[];
      roomChat: {
        id: string;
        userId: string;
        userName: string;
        userAvatar: string;
        text: string;
        timestamp: number;
        reactions?: Record<string, string[]>;
        attachments?: {
          id: string;
          name: string;
          mediaType: string;
          previewUrl: string;
        }[];
      }[];
    };
    UserMeta: {
      id: string;
      info: {
        name: string;
        avatar: string;
        color: string;
      };
    };
    ThreadMetadata: {
      resolved?: boolean;
    };
  }
}

export {};
