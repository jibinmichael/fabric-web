declare global {
  interface Liveblocks {
    Storage: {
      docTitle: string;
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
