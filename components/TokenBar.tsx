import { Progress, Text, Group, Paper } from "@mantine/core";
import { useEffect, useState } from "react";

interface TokenBarProps {
    tokens: number;
    maxTokens: number;
}

export default function TokenBar({ tokens, maxTokens }: TokenBarProps) {
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        // Simple visual timer for 5s regeneration
        const startTime = Date.now();
        const interval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const p = (elapsed % 1000) / 1000 * 100;
            setProgress(p);
        }, 100);
        return () => clearInterval(interval);
    }, []);

    return (
        <Paper withBorder p="xs" radius="md" mb="sm">
            <Group justify="space-between" mb={5}>
                <Text fw={700} size="sm">体力值 (Tokens)</Text>
                <Text size="sm">{tokens} / {maxTokens}</Text>
            </Group>
            <Progress
                value={(tokens / maxTokens) * 100}
                size="xl"
                radius="xl"
                color={tokens > 0 ? "blue" : "red"}
                animated={tokens < maxTokens}
            />
            {tokens < maxTokens && (
                <Progress
                    value={progress}
                    size="xs"
                    mt={5}
                    color="cyan"
                    radius="xs"
                />
            )}
        </Paper>
    );
}
