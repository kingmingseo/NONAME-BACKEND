import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { AuthDto } from './dto/auth.dto';
import bcrypt from 'node_modules/bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EditProfileDto } from './dto/edit-profile.dto';
import { MarkerColor } from 'src/post/marker-color.enum';
import axios from 'axios';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async signup(authDto: AuthDto) {
    const { email, password } = authDto;
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = this.userRepository.create({
      email,
      password: hashedPassword,
      loginType: 'email',
    });

    try {
      await this.userRepository.save(user);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new ConflictException('이미 존재하는 이메일입니다.');
      }
      throw new InternalServerErrorException('회원가입 실패');
    }
  }

  private async getTokens(payload: { email: string }) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_SECRET'),
        expiresIn: this.configService.get('JWT_ACCESS_TOKEN_EXPIRED'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_SECRET'),
        expiresIn: this.configService.get('JWT_REFRESH_TOKEN_EXPIRED'),
      }),
    ]);
    return { accessToken, refreshToken };
  }

  async signin(authDto: AuthDto) {
    const { email, password } = authDto;
    const user = await this.userRepository.findOneBy({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 일치하지 않습니다.',
      );
    }

    const { accessToken, refreshToken } = await this.getTokens({ email });
    await this.updateHashedRefreshToken(user.id, refreshToken);
    return { accessToken, refreshToken };
  }

  private async updateHashedRefreshToken(id: number, refreshToken: string) {
    const salt = await bcrypt.genSalt();
    const hashedRefreshToken = await bcrypt.hash(refreshToken, salt);

    try {
      await this.userRepository.update(id, { hashedRefreshToken });
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Failed to update refresh token');
    }
  }

  async refreshToken(user: User) {
    const { email } = user;
    const { accessToken, refreshToken } = await this.getTokens({ email });

    if (!user.hashedRefreshToken) {
      throw new ForbiddenException('Refresh token not found');
    }

    await this.updateHashedRefreshToken(user.id, refreshToken);

    return { accessToken, refreshToken };
  }

  getProfile(user: User) {
    const { password, hashedRefreshToken, ...rest } = user;
    return { ...rest };
  }

  async editProfile(editProfileDto: EditProfileDto, user: User) {
    const profile = await this.userRepository
      .createQueryBuilder('user')
      .where('user.id = :userId', { userId: user.id })
      .getOne();

    if (!profile) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }

    const { nickname, imageUrl } = editProfileDto;
    profile.nickname = nickname;
    profile.imageUrl = imageUrl;

    try {
      await this.userRepository.save(profile);
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(
        '프로필 수정 도중 에러가 발생했습니다',
      );
    }

    return { message: '프로필 수정 성공' };
  }

  async deleteRefreshToken(user: User) {
    try {
      await this.userRepository.update(user.id, {
        hashedRefreshToken: undefined,
      });
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(
        '로그아웃 도중 에러가 발생했습니다',
      );
    }
  }

  async deleteAccountUser(user: User) {
    try {
      await this.userRepository
        .createQueryBuilder('user')
        .delete()
        .from(User)
        .where('id = :id', { id: user.id })
        .execute();
    } catch (error) {
      console.log(error);
      throw new BadRequestException(
        '탈퇴할 수 없습니다. 남은 포스트가 존재하는지 확인해주세요 ',
      );
    }
  }

  async updateCategory(categories: Record<MarkerColor, string>, user: User) {
    const { RED, YELLOW, BLUE, GREEN, PURPLE } = categories;
    if (
      !Object.keys(categories).every((color: MarkerColor) =>
        [RED, YELLOW, BLUE, GREEN, PURPLE].includes(color),
      )
    ) {
      throw new BadRequestException('유효하지 않는 카테고리 입니다');
    }
    user[RED] = categories[RED];
    user[YELLOW] = categories[YELLOW];
    user[BLUE] = categories[BLUE];
    user[GREEN] = categories[GREEN];
    user[PURPLE] = categories[PURPLE];

    try {
      await this.userRepository.save(user);
    } catch (error: unknown) {
      console.log(error);
      throw new InternalServerErrorException(
        '카테고리 수정 도중 에러가 발생했습니다',
      );
    }

    const { password, hashedRefreshToken, ...rest } = user;
    return { ...rest };
  }

  async kakaoLogin(kakaoToken: { token: string }) {
    const url = 'https://kapi.kakao.com/v2/user/me';
    const headers = {
      Authorization: `Bearer ${kakaoToken.token}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    };
    try {
      const response = await axios.get(url, { headers });
      const userData = response.data;
      const { id: kakaoId, kakao_account } = userData;
      const nickname = kakao_account?.profile.nickname;
      const imageUri = kakao_account?.profile.thumbnail_image_url?.replace(
        '/^http:/',
        'https:',
      );
      const existingUser = await this.userRepository.findOneBy({
        email: kakaoId,
      });

      if (existingUser) {
        const { accessToken, refreshToken } = await this.getTokens({
          email: existingUser.email,
        });
        await this.updateHashedRefreshToken(existingUser.id, refreshToken);
        return { accessToken, refreshToken };
      }

      const newUser = this.userRepository.create({
        email: kakaoId,
        password: nickname ?? '',
        nickname,
        kakaoImageUri: imageUri ?? null,
        loginType: 'kakao',
      });

      try {
        await this.userRepository.save(newUser);
      } catch (error: unknown) {
        console.log(error);
        throw new InternalServerErrorException(
          '카카오 로그인 도중 에러가 발생했습니다',
        );
      }

      const { accessToken, refreshToken } = await this.getTokens({
        email: newUser.email,
      });

      await this.updateHashedRefreshToken(newUser.id, refreshToken);
      return { accessToken, refreshToken };
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Kakao 서버 에러가 발생했습니다.');
    }
  }
}
