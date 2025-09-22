declare module 'elizabot' {
    class ElizaBot {
        constructor(noRandom?: boolean);
        transform(text: string): string;
        getInitial(): string;
        getFinal(): string;
        reset(): void;
        getRules(): any;
    }
    export = ElizaBot;
}
