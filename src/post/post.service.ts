import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreatePostDto } from './dto/create-post.dto';
import { Repository } from 'typeorm';
import { Post } from './post.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/auth/user.entity';
import { Image } from 'src/image/image.entity';
import { SelectQueryBuilder, Brackets } from 'typeorm';

// 서비스에는 컨트롤러 메소드에 따라 db작업등의 로직이 들어간다
@Injectable()
export class PostService {
  constructor(
    @InjectRepository(Post)
    private postRepository: Repository<Post>,
    @InjectRepository(Image)
    private imageRepository: Repository<Image>,
  ) {}
  async getAllMarkers(user: User) {
    try {
      const markers = await this.postRepository
        .createQueryBuilder('post')
        .where('post.user.id = :userId', { userId: user.id })
        .select([
          'post.id',
          'post.latitude',
          'post.longitude',
          'post.color',
          'post.score',
        ])
        .getMany();
      return markers;
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(
        '마커를 가져오는 도중 에러가 발생했습니다',
      );
    }
  }
  private getPostsWithOrderImages(posts: Post[]) {
    return posts.map((post) => {
      const { images, ...rest } = post;
      const newImages = [...images].sort((a, b) => a.id - b.id);

      return {
        ...rest,
        images: newImages,
      };
    });
  }

  private getPostsBaseQuery(userId: number): SelectQueryBuilder<Post> {
    return this.postRepository
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.images', 'images')
      .where('post.userId = :userId', { userId })
      .orderBy('post.date', 'DESC');
  }

  async getMyPosts(page: number, user: User) {
    const perPage = 10;
    const offset = (page - 1) * perPage;
    const queryBuilder = this.getPostsBaseQuery(user.id);
    const posts = await queryBuilder.take(perPage).skip(offset).getMany();

    return this.getPostsWithOrderImages(posts);
  }

  async getPostById(id: number, user: User) {
    try {
      const foundPost = await this.postRepository
        .createQueryBuilder('post')
        .leftJoinAndSelect('post.images', 'images')
        .leftJoinAndSelect('post.favorites', 'favorites')
        .where('post.id = :id', { id })
        .andWhere('post.user.id = :userId', { userId: user.id })
        .getOne();

      if (!foundPost) {
        throw new NotFoundException('해당 게시글을 찾을 수 없습니다');
      }

      const { favorites, ...rest } = foundPost;
      const postWithIsFavorite = {
        ...rest,
        isFavorite: favorites.length > 0,
      };

      return postWithIsFavorite;
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(
        '장소를 가져오는 도중 에러가 발생했습니다',
      );
    }
  }

  async createPost(createPostDto: CreatePostDto, user: User) {
    const {
      latitude,
      longitude,
      title,
      color,
      address,
      date,
      description,
      score,
      imageUris,
    } = createPostDto;

    const post = this.postRepository.create({
      latitude,
      longitude,
      title,
      color,
      address,
      date,
      description,
      score,
      user,
    });
    const images = imageUris.map((uri) => this.imageRepository.create(uri));
    post.images = images;

    try {
      await this.imageRepository.save(images);
      await this.postRepository.save(post);
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(
        '장소를 추가하는 도중 에러가 발생했습니다',
      );
    }
    const { user: _, ...postWithoutUser } = post;
    return postWithoutUser;
  }

  async deletePost(id: number, user: User) {
    try {
      const result = await this.postRepository
        .createQueryBuilder('post')
        .delete()
        .where('userId = :userId', { userId: user.id })
        .andWhere('id = :id', { id })
        .execute();
      if (result.affected === 0) {
        throw new NotFoundException('해당 게시글을 찾을 수 없습니다');
      }
      return id;
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(
        '장소를 삭제하는 도중 에러가 발생했습니다',
      );
    }
  }

  async updatePost(
    id: number,
    updatePostDto: Omit<CreatePostDto, 'latitude' | 'longitude' | 'address'>,
    user: User,
  ) {
    const post = await this.getPostById(id, user);
    const { title, description, score, imageUris, date, color } = updatePostDto;
    post.title = title;
    post.description = description;
    post.score = score;
    post.date = date;
    post.color = color;

    const images = imageUris.map((uri) => this.imageRepository.create(uri));
    post.images = images;
    try {
      await this.imageRepository.save(images);
      await this.postRepository.save(post);
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(
        '장소를 수정하는 도중 에러가 발생했습니다',
      );
    }
    return post;
  }

  async getPostsByMonth(year: number, month: number, user: User) {
    const posts = await this.postRepository
      .createQueryBuilder('post')
      .where('post.userId = :userId', { userId: user.id })
      .andWhere('extract(year from post.date) = :year', { year })
      .andWhere('extract(month from post.date) = :month', { month })
      .select([
        'post.id AS id',
        'post.title AS title',
        'post.address AS address',
        'EXTRACT(DAY FROM post.date) AS day',
      ])
      .getRawMany();

    const groupPostsByDate = posts.reduce((acc, post) => {
      const { id, title, address, date } = post;

      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push({ id, title, address });
      return acc;
    }, {});

    return groupPostsByDate;
  }

  async searchMyPostsByTitleAndAddress(
    query: string,
    page: number,
    user: User,
  ) {
    const perPage = 10;
    const offset = (page - 1) * perPage;
    const queryBuilder = this.getPostsBaseQuery(user.id);
    const posts = await queryBuilder
      .andWhere(
        new Brackets((qb) => {
          qb.where('post.title LIKE :query', { query: `%${query}%` });
          qb.orWhere('post.address LIKE :query', { query: `%${query}%` });
        }),
      )
      .skip(offset)
      .take(perPage)
      .getMany();

    return this.getPostsWithOrderImages(posts);
  }
}
