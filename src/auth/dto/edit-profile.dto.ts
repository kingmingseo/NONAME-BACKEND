import { IsString, MaxLength, MinLength } from 'class-validator';

export class EditProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  nickname: string;

  @IsString()

  imageUrl: string;
}
