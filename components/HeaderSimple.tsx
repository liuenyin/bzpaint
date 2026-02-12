import {
  Group,
  Button,
  Text,
  Box,
  HoverCard,
  Badge,
  UnstyledButton,
  Stack,
} from "@mantine/core";
import classes from "../styles/HeaderSimple.module.css";
import { IconPaint } from "@tabler/icons-react";
import { IconLock } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { API_URL } from "../common/constants";
import { useRouter } from "next/router";
import { socket } from "../common/socket";
import Link from "next/link";

interface headerProps {
  loggedIn: boolean;
  userType: string;
}

import { Modal, TextInput, CopyButton, ActionIcon, Tooltip } from "@mantine/core";
import { useDisclosure } from '@mantine/hooks';
import { IconCopy, IconCheck } from '@tabler/icons-react';

export default function HeaderSimple({ loggedIn, userType }: headerProps) {
  const [playerCount, setPlayerCount] = useState(0);
  const [playerNames, setPlayerNames] = useState<string[]>([]);
  const router = useRouter();

  // Profile Modal State
  const [opened, { open, close }] = useDisclosure(false);
  const [inviteCode, setInviteCode] = useState("");
  const [loadingInvite, setLoadingInvite] = useState(false);

  // Delegation State
  const [delegateTarget, setDelegateTarget] = useState("");
  const [loadingDelegate, setLoadingDelegate] = useState(false);

  async function handleDelegate() {
    setLoadingDelegate(true);
    try {
      const res = await fetch(`${API_URL}/delegate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUsername: delegateTarget || "" })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
      } else {
        alert("设置失败: " + data.error);
      }
    } catch (e) {
      console.error(e);
      alert("设置失败");
    } finally {
      setLoadingDelegate(false);
    }
  }

  useEffect(() => {
    // check if user logged in
    socket.connect(); // Always connect (Guest or User)

    socket.on("onlineUsernames", (data) => {
      setPlayerCount(data.length);
      setPlayerNames(data);
    });

    return () => {
      socket.disconnect();
    };
  }, [loggedIn]);

  async function handleLogOut() {
    try {
      const response = await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
      });
      console.log(response);
      if (response.ok) {
        window.location.href = "/"; // Force reload to clear state
      }
    } catch (error) {
      console.log(error);
    }
  }

  async function generateInvite() {
    setLoadingInvite(true);
    try {
      // Route is /api/invite
      const res = await fetch(`${API_URL}/invite`, { method: 'POST' });
      const data = await res.json();
      if (data.code) {
        setInviteCode(data.code);
      } else {
        alert("生成失败: " + data.error);
      }
    } catch (e) {
      console.error(e);
      alert("生成失败");
    } finally {
      setLoadingInvite(false);
    }
  }

  function UserBadge() {
    if (userType === "Admin") {
      return (
        <Badge
          variant="gradient"
          gradient={{ from: "violet", to: "grape", deg: 360 }}
        >
          管理员
        </Badge>
      );
    }
    if (userType === "Basic") {
      return <Badge color="gray">普通用户</Badge>;
    }
    return <Badge color="gray">游客</Badge>;
  }

  function displayUsernames() {
    return <Text> {playerNames?.join(", ")}</Text>;
  }
  return (
    <Box pb={20}>
      <header className={classes.header}>
        <Group justify="space-between" h="100%">
          <Group aria-label="PaintBoard Logo" visibleFrom="sm">
            <IconPaint />
            <Text size="xl" fw={900}>
              冬日绘板
            </Text>
          </Group>

          <Group>
            {/* Remove link to upgrade */}
            <Box>{UserBadge()}</Box>
            <HoverCard width={280} shadow="md">
              <HoverCard.Target>
                <UnstyledButton>
                  {" "}
                  <Text size="md" fw={600}>
                    {playerCount} {playerCount > 1 ? "人" : "人"}{" "}
                    在线
                  </Text>
                </UnstyledButton>
              </HoverCard.Target>
              <HoverCard.Dropdown>{displayUsernames()}</HoverCard.Dropdown>
            </HoverCard>
          </Group>

          <Group>
            {loggedIn ? (
              <>
                <Button onClick={open} variant="outline">个人中心</Button>
                <Button
                  onClick={handleLogOut}
                  aria-label="Log out"
                  variant="default"
                >
                  登出
                </Button>
              </>
            ) : (
              <Group>
                <Button component={Link} href="/login" variant="default">登录</Button>
                <Button component={Link} href="/register">注册</Button>
              </Group>
            )}
          </Group>
        </Group>
      </header>

      <Modal opened={opened} onClose={close} title="个人中心 (Profile)">
        <Stack>
          <Text>当前身份: {userType}</Text>
          {/* Invite Code Generator */}
          <Group>
            <Button onClick={generateInvite} loading={loadingInvite}>生成邀请码</Button>
            {inviteCode && (
              <Group gap="xs">
                <Text fw={700} c="blue">{inviteCode}</Text>
                <CopyButton value={inviteCode} timeout={2000}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow position="right">
                      <ActionIcon color={copied ? 'teal' : 'gray'} variant="subtle" onClick={copy}>
                        {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              </Group>
            )}
          </Group>
          <Text size="xs" c="dimmed">邀请码用于邀请新用户注册。生成的邀请码一次性有效。</Text>

          <Text fw={700} mt="md">代练 (Token Delegation)</Text>
          <Text size="xs" c="dimmed">将你的体力产出持续转让给他人。输入用户名并点击设置即可开始；留空则取消委托。</Text>
          <Group align="end">
            <TextInput
              label="受益人用户名"
              placeholder="目标用户名 (留空取消)"
              value={delegateTarget}
              onChange={(e) => setDelegateTarget(e.currentTarget.value)}
            />
            <Button onClick={handleDelegate} loading={loadingDelegate}>
              {delegateTarget ? "设置委托" : "取消委托"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
