declare global {
  interface Liveblocks {
    Presence: {
      viewingSection: string | null;
      cursor: { x: number; y: number } | null;
    };
    Storage: {
      gapPosted: boolean;
      ownerId: string;
      docTitle: string;
      planJson: string;
      planLines: string[];
      chatMessages: { role: string; content: string }[];
      challengedThreadIds: string[];
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
