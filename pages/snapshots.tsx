
import React, { useEffect, useState } from 'react';
import { Container, Title, SimpleGrid, Card, Image, Text, Group, Loader, Alert } from '@mantine/core';
import HeaderSimple from '../components/HeaderSimple';

interface Snapshot {
    id: number;
    created_at: string;
}

export default function SnapshotsPage() {
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        fetch('/api/snapshot/list')
            .then(res => {
                if (!res.ok) throw new Error('Failed to fetch snapshots');
                return res.json();
            })
            .then(data => {
                setSnapshots(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setError('无法加载快照列表');
                setLoading(false);
            });
    }, []);

    return (
        <>
            <HeaderSimple />
            <Container size="xl" py="xl">
                <Title order={2} mb="lg">快照归档 (Snapshots)</Title>

                {loading && <Loader />}
                {error && <Alert color="red">{error}</Alert>}

                {!loading && !error && snapshots.length === 0 && (
                    <Text>暂无快照。</Text>
                )}

                <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="lg">
                    {snapshots.map((snap) => (
                        <Card key={snap.id} shadow="sm" padding="lg" radius="md" withBorder>
                            <Card.Section>
                                <Image
                                    src={`/api/snapshot/${snap.id}`}
                                    height={160}
                                    alt={`Snapshot ${snap.id}`}
                                    fit="contain"
                                    fallbackSrc="https://placehold.co/600x400?text=Error"
                                />
                            </Card.Section>

                            <Group justify="space-between" mt="md" mb="xs">
                                <Text fw={500}>ID: {snap.id}</Text>
                                <Text size="sm" c="dimmed">
                                    {new Date(snap.created_at).toLocaleString()}
                                </Text>
                            </Group>
                        </Card>
                    ))}
                </SimpleGrid>
            </Container>
        </>
    );
}
