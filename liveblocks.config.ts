declare global {
  interface Liveblocks {
    Storage: {
      docTitle: string;
      planJson: string;
      planLines: string[];
      chatMessages: { role: string; content: string }[];
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
