import {
  Title,
  Text,
  Container,
  Paper,
  Stack,
  List,
  ThemeIcon,
  rem,
  Alert,
  Loader
} from "@mantine/core";
import { IconCheck, IconInfoCircle } from "@tabler/icons-react";
import classes from "../styles/HeroText.module.css";
import { loginDetails, User } from "../common/types";
import Canvas from "../components/Canvas";
import HeaderSimple from "../components/HeaderSimple";
import { useEffect, useState } from "react";

interface pageProps {
  loginHandler: (details: loginDetails) => void;
  loggedIn: boolean;
  userData: User;
}

export default function HomePage({ loginHandler, loggedIn, userData }: pageProps) {
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    fetch('/api/announcement')
      .then(res => res.json())
      .then(data => setAnnouncement(data.message))
      .catch(console.error);
  }, []);

  return (
    <div style={{ paddingBottom: '50px' }}>
      <HeaderSimple loggedIn={loggedIn} userType={userData?.type || 'Guest'} />

      <Container size="xl">
        <Stack gap="xl">
          {/* Announcement Banner */}
          {announcement && (
            <Alert variant="light" color="blue" title="公告 (Announcement)" icon={<IconInfoCircle />}>
              {announcement}
            </Alert>
          )}

          {/* Canvas Section */}
          <Paper shadow="sm" p="md" withBorder radius="md">
            <Canvas loggedIn={loggedIn} userData={userData || { type: 'Guest', tokens: 0, id: 'guest', username: 'Guest', email: '' }} />
          </Paper>

          {/* Intro Section */}
          <Paper shadow="sm" p="xl" radius="md" withBorder>
            <Title order={2} mb="md">关于冬日绘板 (About Winter Paintboard)</Title>
            <Text mb="md">
              冬日绘板是一个实时协作的像素画板，灵感来源于 Reddit 的 r/place。
              在这里，你可以和同学们一起创作像素艺术，或者通过智能辅助功能上传图片自动绘制。
            </Text>

            <Title order={3} mb="sm" size="h4">功能特色</Title>
            <List
              spacing="xs"
              size="sm"
              center
              icon={
                <ThemeIcon color="teal" size={24} radius="xl">
                  <IconCheck style={{ width: rem(16), height: rem(16) }} />
                </ThemeIcon>
              }
            >
              <List.Item>实时同步：所有人都可以看到画布的实时变化。</List.Item>
              <List.Item>智能辅助：上传图片，可以自定义缩放和位置进行绘制。</List.Item>
              <List.Item>邀请注册：使用邀请码加入，维护社区秩序。</List.Item>
            </List>
          </Paper>
        </Stack>
      </Container>
    </div>
  );
}
