export const appOrigin = () => new URL(process.env.BETTER_AUTH_URL || 'http://localhost:3000').origin
