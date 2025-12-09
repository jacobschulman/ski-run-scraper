import React from 'react';
import Svg, { Path, SvgProps } from 'react-native-svg';

interface IconProps extends SvgProps {
  size?: number;
  color?: string;
}

export function FluentMdl2SkiResorts({ size = 24, color = '#8e8e93', ...props }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 2048 2048" {...props}>
      <Path
        fill={color}
        d="m1472 640l574 1152H0L768 256l447 897zm0 287l-185 369l47 95l111-111h203zM898 803L768 543L638 803l130 130zm-691 861h1121L958 924l-190 191l-191-191zm1263 0h369l-127-256h-213l-104 104z"
      />
    </Svg>
  );
}